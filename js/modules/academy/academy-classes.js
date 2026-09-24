/**
 * js/modules/academy/academy-classes.js - Academy Classes
 * SINGLE SOURCE OF TRUTH for all academy class ENTITY data AND
 * character ↔ class membership mutations.
 *
 * Path: js/modules/academy/academy-classes.js
 *
 * This module is responsible for:
 *   - Class entity CRUD operations (create, update, delete)
 *   - Class lookup (by ID, by name, by status)
 *   - Class entity mutations
 *   - Character ↔ class membership mutations (addToClass,
 *     removeClassById, addClassByName, removeFromAllClasses)
 *   - Instructor-of-class derivation (getClassInstructorIds,
 *     getClassInstructorIdsAllTime), sourced from per-discipline
 *     instructor enrolments
 *   - Class rest days (class.restDays, class.restDaysByWeek)
 *
 * This module is NOT responsible for:
 *   - Class membership STORAGE. Membership lives on
 *     character.classIds.
 *   - Class roster DERIVATION. AcademyQueries derives rosters from
 *     character.classIds.
 *   - Cross-domain cascade cleanup. That is owned by AcademyCascade.
 *   - Per-discipline instructor assignment. That is an ENROLMENT,
 *     written by the instructor-side Disciplines tab in the
 *     character detail panel, through AcademyEnrolments.enrol.
 *   - Applying rest days to schedule projections. The calendar
 *     aggregator reads rest days and the projector suppresses
 *     occurrences that fall on them. This module owns the storage
 *     and validation of the fields, not their effect.
 *
 * IMPORTANT (v15+):
 *   - Character membership is stored on character.classIds[].
 *   - The academy roster is DERIVED: characters whose classIds
 *     include classId. AcademyQueries owns that derivation.
 *
 * NO CLASS-LEVEL INSTRUCTOR (v29):
 *   Prior to this revision, a class record carried `instructorId`.
 *   That field was retired. Instructors are per-discipline
 *   enrolments. See getClassInstructorIds below.
 *
 * REST DAYS (v30, extended in v31):
 *   class.restDays = [dayNumber, ...]
 *     The DEFAULT rest days. Every week not overridden by
 *     restDaysByWeek uses this array.
 *
 *   class.restDaysByWeek = { [week]: [dayNumber, ...], ... }
 *     Sparse overrides. When a week key is present, its array is
 *     the effective rest days for that week. When absent, the
 *     default applies.
 *
 *   Day numbers are integers in
 *   [CalendarConstants.MIN_DAY, CalendarConstants.MAX_DAY].
 *   Empty array means "no rest days."
 *
 *   A class's effective rest days for a given week are:
 *
 *     getRestDaysForWeek(classId, week)
 *
 *   which returns restDaysByWeek[week] when present, and falls
 *   back to restDays otherwise.
 *
 *   MALFORMED WEEK:
 *     An invalid week (null, NaN, out of range) is NOT a request
 *     for the default rest days. It is an unanswerable question.
 *     getRestDaysForWeek returns [] in that case. The caller
 *     cannot distinguish "the class has no rest days" from "the
 *     week was invalid" at this API; callers that need the
 *     distinction should pre-validate the week.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the `appData` argument it is handed. It does not read
 *   window.data. Preflight reads against window.data are for
 *   early UX feedback only; the pipeline re-checks against the
 *   snapshot.
 *
 *   This applies to:
 *     - create: name-uniqueness against the snapshot
 *     - update: name-uniqueness against the snapshot
 *     - deleteClass: existence in the snapshot
 *     - addToClass / removeClassById / addClassByName /
 *       removeFromAllClasses: the character and class exist in
 *       the snapshot, and the membership invariant holds there
 *
 * CLASS-NAME COMPARISON:
 *   Two class names match when their normalised forms
 *   (trim + lowercase) are equal. This is the SINGLE authority
 *   for name comparison; every lookup and uniqueness check goes
 *   through normaliseClassName().
 *
 * READ SAFETY (Phase 2):
 *   - getAcademyStore() returns null when the store is missing.
 *     Reads are side-effect free.
 *   - Public lookups return DEEP CLONES.
 *   - Internal lookups return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData`
 *     argument.
 *   - ObjectUtils.deepClone throws if cloning fails or if the
 *     clone aliases the input.
 *
 * DELETE CASCADE (Phase 8):
 *   Deleting a class is a CASCADE. In a single MutationPipeline
 *   transaction it:
 *     1. Strips the classId from every character's classIds array.
 *     2. Deletes the class entity from academy.graduatingClasses.
 *     3. Cross-domain cleanup: enrolments, grades, rankings,
 *        social scores, weekly teams, teaching sessions, teaching
 *        groups, instructor commitments. Delegated to
 *        AcademyCascade.classDeleted.
 *
 *   AcademyCascade.classDeleted is MANDATORY at deletion time.
 *   Lazy lookup solves load order; it does not make the
 *   dependency optional. A missing cascade fails the transaction.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers. A null year is valid.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.ValidationUtils
 *   - window.MutationPipeline
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.RangeUtils
 *
 * DEPENDENCIES (LAZY, mandatory at call time):
 *   - window.AcademyCascade                    (deleteClass)
 *   - window.CharacterQueries                  (membership mutations)
 *   - window.AcademyClassDisciplinesQueries    (getClassInstructorIds)
 *
 * USAGE:
 *   var classes = window.AcademyClasses;
 *
 *   var result = classes.create('Class of 2026');
 *   var result = classes.update('class_123', {
 *       name: 'New Name',
 *       restDays: [6, 7],
 *       restDaysByWeek: { 3: [5], 7: [] }
 *   });
 *   var result = classes.delete('class_123');
 *
 *   var cls = classes.getClass('class_123');
 *   var all = classes.getClasses();
 *   var byName = classes.getClassByName('Class of 2026');
 *   var restDays = classes.getRestDaysForWeek('class_123', 3);
 *
 *   // Membership mutations
 *   classes.addToClass('char_456', 'class_123').then(...);
 *   classes.removeClassById('char_456', 'class_123').then(...);
 *   classes.addClassByName('char_456', 'New Class').then(...);
 *   classes.removeFromAllClasses('char_456').then(...);
 *
 *   // Instructor queries
 *   var teachingThisWeek = classes.getClassInstructorIds(
 *       'class_123', 5
 *   );
 *   var taughtEnglishThisWeek = classes.getClassInstructorIds(
 *       'class_123', 5, { disciplineId: 'disc_en' }
 *   );
 *   var everTaught = classes.getClassInstructorIdsAllTime(
 *       'class_123'
 *   );
 */

(function() {
    'use strict';

    if (window.__academyClassesLoaded) {
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

    if (!window.CalendarConstants ||
        typeof window.CalendarConstants.MIN_WEEK !== 'number' ||
        typeof window.CalendarConstants.MAX_WEEK !== 'number' ||
        typeof window.CalendarConstants.MIN_DAY !== 'number' ||
        typeof window.CalendarConstants.MAX_DAY !== 'number') {
        missing.push('CalendarConstants week/day bounds');
    }

    if (!window.CalendarValidation ||
        typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.RangeUtils ||
        typeof window.RangeUtils.containsWeek !== 'function') {
        missing.push('RangeUtils.containsWeek');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyClasses] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyClassesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var RangeUtils = window.RangeUtils;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================
    //
    // Lazy resolution solves load order. It does NOT make a
    // dependency optional at call time. Callers that need a
    // dependency (deleteClass needs AcademyCascade; membership
    // mutations need CharacterQueries; getClassInstructorIds
    // needs AcademyClassDisciplinesQueries) throw when the
    // dependency is absent.

    function getAcademyCascade() {
        return window.AcademyCascade || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getAcademyClassDisciplinesQueries() {
        return window.AcademyClassDisciplinesQueries || null;
    }

    /**
     * Resolve CharacterQueries or throw. Used by every call site
     * that depends on it.
     */
    function requireCharacterQueries(contextLabel) {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            throw new Error(
                '[AcademyClasses] CharacterQueries.getCharacterById is ' +
                'required by ' + contextLabel + '. Check the script load ' +
                'order in index.html.'
            );
        }
        return CQ;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = ['active', 'archived', 'graduated'];
    var DEFAULT_STATUS = 'active';

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyClasses] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
    }

    function generateId() {
        return IdUtils.generateId('class');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

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

    /**
     * Normalise a class name for comparison.
     * Trims leading/trailing whitespace and lowercases. Empty or
     * invalid input returns ''.
     *
     * This is the SINGLE authority for name comparison in this
     * module. Every lookup and uniqueness check goes through it.
     * Do not inline `String(x).toLowerCase().trim()` anywhere.
     */
    function normaliseClassName(name) {
        if (name === null || name === undefined) {
            return '';
        }
        return String(name).trim().toLowerCase();
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

    // ============================================================
    // INTERNAL CLASS LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

    function getClassInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return null;
        }

        var target = String(classId);
        return academy.graduatingClasses[target] || null;
    }

    function getClassesInternal() {
        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return [];
        }

        var result = [];
        for (var id in academy.graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(academy.graduatingClasses, id)) {
                var cls = academy.graduatingClasses[id];
                if (cls) {
                    result.push(cls);
                }
            }
        }

        return result;
    }

    function getClassesByStatusInternal(status) {
        if (!isNonEmptyString(status)) {
            return getClassesInternal();
        }

        var all = getClassesInternal();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].status === status) {
                result.push(all[i]);
            }
        }

        return result;
    }

    function getActiveClassesInternal() {
        return getClassesByStatusInternal('active');
    }

    function getClassByNameInternal(name) {
        var target = normaliseClassName(name);
        if (target === '') {
            return null;
        }

        var classes = getClassesInternal();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && normaliseClassName(cls.name) === target) {
                return cls;
            }
        }

        return null;
    }

    function getClassDisplayNameInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return 'Unknown Class';
        }

        return cls.name || 'Unnamed Class';
    }

    // ============================================================
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================
    //
    // Used by pipeline validate() callbacks. Read from the appData
    // snapshot, not window.data.

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    function findClassInSnapshot(appData, classId) {
        if (!appData || !appData.academy ||
            !isObject(appData.academy.graduatingClasses)) {
            return null;
        }
        var target = String(classId);
        return appData.academy.graduatingClasses[target] || null;
    }

    /**
     * Find a class by normalised name in the snapshot.
     * Returns the matching record or null.
     */
    function findClassByNameInSnapshot(appData, name) {
        var target = normaliseClassName(name);
        if (target === '') {
            return null;
        }
        if (!appData || !appData.academy ||
            !isObject(appData.academy.graduatingClasses)) {
            return null;
        }
        var store = appData.academy.graduatingClasses;
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var cls = store[keys[i]];
            if (cls && normaliseClassName(cls.name) === target) {
                return cls;
            }
        }
        return null;
    }

    function characterHasClassId(char, classId) {
        if (!char || !Array.isArray(char.classIds)) {
            return false;
        }
        var target = String(classId);
        for (var i = 0; i < char.classIds.length; i++) {
            if (String(char.classIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // CHARACTER ↔ CLASS - READ PATH (INTERNAL)
    // ============================================================

    function getCharacterClassNamesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var names = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    names.push(classes[j].name);
                    break;
                }
            }
        }

        return names;
    }

    function getCharacterClassesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var result = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    result.push(classes[j]);
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // INSTRUCTOR-OF-CLASS DERIVATION
    // ============================================================
    //
    // A class does not carry an instructor field. The instructors of
    // a class are whoever has an instructor-mode enrolment in one of
    // the class's offerings.
    //
    // TWO QUERIES, TWO QUESTIONS:
    //
    //   getClassInstructorIds(classId, week, options)
    //     "Who teaches something in this class DURING this week?"
    //     Week-scoped.
    //
    //   getClassInstructorIdsAllTime(classId)
    //     "Who has EVER taught something in this class?"
    //     NOT week-scoped.
    //
    // MANDATORY DEPENDENCIES:
    //   getClassInstructorIds requires:
    //     - AcademyClassDisciplinesQueries (offering filter)
    //     - CharacterQueries (mode lookup)
    //
    //   getClassInstructorIdsAllTime requires:
    //     - CharacterQueries
    //
    //   A missing dependency THROWS. It does not return [].
    //   [] means "nobody teaches this class," which is a different
    //   answer from "the answer could not be determined."
    //
    // NOT AUTHORITATIVE INSIDE A MUTATION TRANSACTION:
    //   Both functions read window.data through the live store.
    //   Neither is authoritative inside a MutationPipeline
    //   transaction. AcademySchedule.assignStudentToSlot
    //   re-resolves against the pipeline snapshot using the same
    //   rule, expressed transaction-locally.

    function getClassInstructorIds(classId, week, options) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var academy = getAcademyStore();
        if (!academy) {
            return [];
        }

        var enrolments = academy.enrolments;
        if (!isObject(enrolments)) {
            return [];
        }

        var byClass = enrolments[String(classId)];
        if (!isObject(byClass)) {
            return [];
        }

        // ---- Offering filter is MANDATORY ----
        //
        // The offering filter is part of the definition of "teaches
        // this class this week." A missing offerings module is a
        // failure, not a mode where every enrolment interval counts.
        var Queries = getAcademyClassDisciplinesQueries();
        if (!Queries ||
            typeof Queries.getClassDisciplinesForClass !== 'function' ||
            typeof Queries.isActiveInWeek !== 'function') {
            throw new Error(
                '[AcademyClasses] AcademyClassDisciplinesQueries ' +
                '(getClassDisciplinesForClass, isActiveInWeek) is ' +
                'required by getClassInstructorIds. Check the script ' +
                'load order in index.html.'
            );
        }

        var offeringSet = Object.create(null);
        var offerings = Queries.getClassDisciplinesForClass(classId) || [];
        for (var oi = 0; oi < offerings.length; oi++) {
            var rec = offerings[oi];
            if (!rec || !rec.disciplineId) { continue; }
            var active = Queries.isActiveInWeek(
                classId, rec.disciplineId, weekNum
            ) === true;
            if (active) {
                offeringSet[String(rec.disciplineId)] = true;
            }
        }

        var disciplineFilter = null;
        if (options && isNonEmptyString(options.disciplineId)) {
            disciplineFilter = String(options.disciplineId);
        }

        // ---- CharacterQueries is MANDATORY ----
        //
        // Without it, the module cannot determine whether an
        // enrolled character is an instructor. Throwing is correct;
        // returning [] would be a false answer.
        var CQ = requireCharacterQueries('getClassInstructorIds');

        var result = Object.create(null);
        var charIds = Object.keys(byClass);

        for (var ci = 0; ci < charIds.length; ci++) {
            var charId = charIds[ci];
            var intervals = byClass[charId];
            if (!Array.isArray(intervals)) { continue; }

            var matchedDiscipline = false;
            for (var ii = 0; ii < intervals.length; ii++) {
                var iv = intervals[ii];
                if (!iv || typeof iv !== 'object') { continue; }

                var discId = isNonEmptyString(iv.disciplineId)
                    ? String(iv.disciplineId)
                    : null;
                if (discId === null) { continue; }

                if (disciplineFilter !== null &&
                    discId !== disciplineFilter) {
                    continue;
                }

                if (offeringSet[discId] !== true) {
                    continue;
                }

                if (!RangeUtils.containsWeek(
                    weekNum, iv.startWeek, iv.endWeek
                )) {
                    continue;
                }

                matchedDiscipline = true;
                break;
            }

            if (!matchedDiscipline) { continue; }

            var char = CQ.getCharacterById(charId);
            if (!char || typeof char !== 'object') { continue; }
            if (char.mode !== 'instructor') { continue; }

            result[String(charId)] = true;
        }

        var out = Object.keys(result);
        out.sort();
        return out;
    }

    function getClassInstructorIdsAllTime(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var academy = getAcademyStore();
        if (!academy) {
            return [];
        }

        var enrolments = academy.enrolments;
        if (!isObject(enrolments)) {
            return [];
        }

        var byClass = enrolments[String(classId)];
        if (!isObject(byClass)) {
            return [];
        }

        var CQ = requireCharacterQueries('getClassInstructorIdsAllTime');

        var result = Object.create(null);
        var charIds = Object.keys(byClass);

        for (var ci = 0; ci < charIds.length; ci++) {
            var charId = charIds[ci];
            var intervals = byClass[charId];

            if (!Array.isArray(intervals) || intervals.length === 0) {
                continue;
            }

            var char = CQ.getCharacterById(charId);
            if (!char || typeof char !== 'object') { continue; }
            if (char.mode !== 'instructor') { continue; }

            result[String(charId)] = true;
        }

        var out = Object.keys(result);
        out.sort();
        return out;
    }

    // ============================================================
    // YEAR VALIDATION
    // ============================================================

    function validateYearValue(value) {
        if (value === undefined || value === null || value === '') {
            return { valid: true, value: null };
        }

        var num = Number(value);
        if (isNaN(num) || !Number.isInteger(num) || num < 1) {
            return {
                valid: false,
                value: null,
                message: 'Year must be a positive number.'
            };
        }

        return { valid: true, value: num };
    }

    // ============================================================
    // REST DAYS VALIDATION
    // ============================================================
    //
    // Returns { valid: true, value: array|undefined } on success,
    // or { valid: false, message } on failure.
    //
    // The normaliser (normaliseRestDays) returns the array on
    // success, and null on validation failure. null means "the
    // stored value is invalid," which is distinguishable from []
    // ("no rest days").
    //
    // Silent no-op:
    //   - a caller who passes `undefined` gets the current value
    //     preserved (the normaliser returns [] in that case,
    //     matching the historical shape for "no override").

    function validateRestDaysValue(value) {
        if (value === undefined) {
            return { valid: true, value: undefined };
        }

        if (!Array.isArray(value)) {
            return {
                valid: false,
                value: null,
                message: 'Rest days must be an array of day numbers.'
            };
        }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < value.length; i++) {
            var raw = value[i];

            if (raw === null || raw === undefined || raw === '') {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest days must not contain empty values.'
                };
            }

            var n = Number(raw);
            if (!Number.isInteger(n)) {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest day "' + raw + '" is not an integer.'
                };
            }

            if (n < MIN_DAY || n > MAX_DAY) {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest day ' + n + ' is out of range (' +
                        MIN_DAY + '-' + MAX_DAY + ').'
                };
            }

            var key = String(n);
            if (seen[key]) { continue; }
            seen[key] = true;
            result.push(n);
        }

        result.sort(function(a, b) { return a - b; });

        return { valid: true, value: result };
    }

    /**
     * Normalise a rest-days value.
     *
     * Returns:
     *   - the canonical array when the input is valid
     *   - [] when the input is undefined (no override)
     *   - null when the input is invalid (malformed array)
     *
     * null is the honest answer for "this stored value is corrupt."
     * Callers that need to distinguish "no rest days" from "corrupt
     * rest days" check for null.
     */
    function normaliseRestDays(value) {
        var check = validateRestDaysValue(value);
        if (!check.valid) {
            return null;
        }
        if (check.value === undefined) {
            return [];
        }
        return check.value;
    }

    // ============================================================
    // REST DAYS BY WEEK VALIDATION
    // ============================================================

    function validateRestDaysByWeekValue(value) {
        if (value === undefined) {
            return { valid: true, value: undefined };
        }

        if (!isObject(value)) {
            return {
                valid: false,
                value: null,
                message: 'Rest days by week must be an object.'
            };
        }

        var result = {};
        var keys = Object.keys(value);

        for (var i = 0; i < keys.length; i++) {
            var rawKey = keys[i];
            var weekNum = parseWeekStrict(rawKey);
            if (weekNum === null) {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest days by week key "' + rawKey +
                        '" is not a valid week (' +
                        MIN_WEEK + '-' + MAX_WEEK + ').'
                };
            }

            var dayCheck = validateRestDaysValue(value[rawKey]);
            if (!dayCheck.valid) {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest days for week ' + weekNum + ': ' +
                        dayCheck.message
                };
            }
            if (dayCheck.value === undefined) {
                return {
                    valid: false,
                    value: null,
                    message: 'Rest days for week ' + weekNum +
                        ' must be an array.'
                };
            }

            result[String(weekNum)] = dayCheck.value;
        }

        return { valid: true, value: result };
    }

    /**
     * Normalise a rest-days-by-week map.
     *
     * Returns:
     *   - the canonical map when the input is valid
     *   - {} when the input is undefined (no override)
     *   - null when the input is invalid
     */
    function normaliseRestDaysByWeek(value) {
        var check = validateRestDaysByWeekValue(value);
        if (!check.valid) {
            return null;
        }
        if (check.value === undefined) {
            return {};
        }
        return check.value;
    }

    // ============================================================
    // CLASS-LEVEL INSTRUCTOR PAYLOAD GUARD
    // ============================================================

    var RETIRED_INSTRUCTOR_MESSAGE =
        'instructorId is not a class field. Instructor assignment is ' +
        'per-discipline: open the character in instructor mode and ' +
        'use the Disciplines tab to assign a discipline to teach.';

    function rejectInstructorField(payload) {
        if (payload && Object.prototype.hasOwnProperty.call(payload, 'instructorId')) {
            return RETIRED_INSTRUCTOR_MESSAGE;
        }
        return null;
    }

    // ============================================================
    // PUBLIC API - CLASS ENTITY CRUD
    // ============================================================

    function create(name, options) {
        if (!isNonEmptyString(name)) {
            return Promise.resolve(failure('Class name is required.'));
        }

        var trimmedName = String(name).trim();

        var existing = getClassByNameInternal(trimmedName);
        if (existing) {
            return Promise.resolve(failure('A class with this name already exists.'));
        }

        options = options || {};

        var retiredInstructor = rejectInstructorField(options);
        if (retiredInstructor !== null) {
            return Promise.resolve(failure(retiredInstructor));
        }

        var status = options.status || DEFAULT_STATUS;
        if (VALID_STATUSES.indexOf(status) === -1) {
            return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
        }

        var yearResult = validateYearValue(options.year);
        if (!yearResult.valid) {
            return Promise.resolve(failure(yearResult.message));
        }

        var restDaysResult = validateRestDaysValue(options.restDays);
        if (!restDaysResult.valid) {
            return Promise.resolve(failure(restDaysResult.message));
        }

        var restDaysByWeekResult = validateRestDaysByWeekValue(
            options.restDaysByWeek
        );
        if (!restDaysByWeekResult.valid) {
            return Promise.resolve(failure(restDaysByWeekResult.message));
        }

        var restDays = restDaysResult.value === undefined
            ? []
            : restDaysResult.value;

        var restDaysByWeek = restDaysByWeekResult.value === undefined
            ? {}
            : restDaysByWeekResult.value;

        var now = new Date().toISOString();
        var classId = generateId();

        var newClass = {
            id: classId,
            name: trimmedName,
            status: status,
            year: yearResult.value,
            description: options.description || '',
            restDays: restDays,
            restDaysByWeek: restDaysByWeek,
            createdAt: now,
            updatedAt: now
        };

        var normalisedNewName = normaliseClassName(trimmedName);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: true };
                }

                // Name uniqueness against the transaction snapshot.
                var conflict = findClassByNameInSnapshot(
                    appData, normalisedNewName
                );
                if (conflict) {
                    return {
                        valid: false,
                        message: 'A class with this name already exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || typeof data.academy !== 'object') {
                    data.academy = {};
                }
                if (!data.academy.graduatingClasses ||
                    typeof data.academy.graduatingClasses !== 'object' ||
                    Array.isArray(data.academy.graduatingClasses)) {
                    data.academy.graduatingClasses = {};
                }
                data.academy.graduatingClasses[classId] = newClass;
                return { class: newClass, classId: classId };
            },
            logMessage: function() {
                return 'Created class: ' + trimmedName;
            },
            successMessage: function() {
                return 'Class created successfully!';
            },
            failureMessage: 'Failed to create class.'
        });
    }

    function update(classId, updates) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var retiredInstructor = rejectInstructorField(updates);
        if (retiredInstructor !== null) {
            return Promise.resolve(failure(retiredInstructor));
        }

        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone class data.'));
        }

        if (!Array.isArray(candidate.restDays)) {
            candidate.restDays = [];
        }
        if (!isObject(candidate.restDaysByWeek)) {
            candidate.restDaysByWeek = {};
        }

        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return Promise.resolve(failure('Class name cannot be empty.'));
            }
            var newName = String(updates.name).trim();
            if (normaliseClassName(newName) !== normaliseClassName(existing.name)) {
                var duplicate = getClassByNameInternal(newName);
                if (duplicate && String(duplicate.id) !== target) {
                    return Promise.resolve(failure('A class with this name already exists.'));
                }
                candidate.name = newName;
            }
        }

        if (updates.status !== undefined) {
            if (VALID_STATUSES.indexOf(updates.status) === -1) {
                return Promise.resolve(failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', ')));
            }
            candidate.status = updates.status;
        }

        if (updates.year !== undefined) {
            var yearResult = validateYearValue(updates.year);
            if (!yearResult.valid) {
                return Promise.resolve(failure(yearResult.message));
            }
            candidate.year = yearResult.value;
        }

        if (updates.description !== undefined) {
            candidate.description = updates.description || '';
        }

        if (updates.restDays !== undefined) {
            var restDaysResult = validateRestDaysValue(updates.restDays);
            if (!restDaysResult.valid) {
                return Promise.resolve(failure(restDaysResult.message));
            }
            candidate.restDays = restDaysResult.value;
        }

        if (updates.restDaysByWeek !== undefined) {
            var rdwResult = validateRestDaysByWeekValue(
                updates.restDaysByWeek
            );
            if (!rdwResult.valid) {
                return Promise.resolve(failure(rdwResult.message));
            }
            candidate.restDaysByWeek = rdwResult.value;
        }

        candidate.updatedAt = new Date().toISOString();
        var normalisedCandidateName = normaliseClassName(candidate.name);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy ||
                    !isObject(appData.academy.graduatingClasses)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!findClassInSnapshot(appData, target)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                // Name uniqueness against the snapshot. The
                // conflicting class, if any, must not be this one.
                var conflict = findClassByNameInSnapshot(
                    appData, normalisedCandidateName
                );
                if (conflict && String(conflict.id) !== target) {
                    return {
                        valid: false,
                        message: 'A class with this name already exists.'
                    };
                }

                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || !data.academy.graduatingClasses) {
                    throw new Error('Academy data is not available.');
                }
                if (!data.academy.graduatingClasses[target]) {
                    throw new Error('Class not found in data store.');
                }
                data.academy.graduatingClasses[target] = candidate;
                return { class: candidate };
            },
            logMessage: function() {
                return 'Updated class: ' + candidate.name;
            },
            successMessage: 'Class updated successfully!',
            failureMessage: 'Failed to update class.'
        });
    }

    /**
     * Delete a class permanently.
     *
     * AcademyCascade.classDeleted is MANDATORY at deletion time.
     */
    function deleteClass(classId) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var target = String(classId);
        var existing = getClassInternal(target);

        if (!existing) {
            return Promise.resolve(failure('Class not found.'));
        }

        var className = existing.name;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy ||
                    !isObject(appData.academy.graduatingClasses)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!findClassInSnapshot(appData, target)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!data.academy || !data.academy.graduatingClasses) {
                    throw new Error('Academy data is not available.');
                }
                if (!data.academy.graduatingClasses[target]) {
                    throw new Error('Class not found in data store.');
                }

                // ---- 1. Strip classId from every character ----
                var affectedCharacters = 0;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        var char = data.characters[i];
                        if (!char || !Array.isArray(char.classIds)) {
                            continue;
                        }
                        var before = char.classIds.length;
                        char.classIds = char.classIds.filter(function(id) {
                            return String(id) !== target;
                        });
                        if (char.classIds.length !== before) {
                            affectedCharacters++;
                        }
                    }
                }

                // ---- 2. Delete the class entity ----
                delete data.academy.graduatingClasses[target];

                // ---- 3. Cross-domain cascade (MANDATORY) ----
                var Cascade = getAcademyCascade();
                if (!Cascade ||
                    typeof Cascade.classDeleted !== 'function') {
                    throw new Error(
                        '[AcademyClasses] AcademyCascade.classDeleted ' +
                        'is required for class deletion. Check the ' +
                        'script load order in index.html.'
                    );
                }

                var cascade = Cascade.classDeleted(data, target);

                return {
                    deleted: true,
                    classId: target,
                    className: className,
                    affectedCharacters: affectedCharacters,
                    academyCascade: cascade
                };
            },
            logMessage: function(result) {
                var parts = [];
                if (result.affectedCharacters > 0) {
                    parts.push(result.affectedCharacters + ' character(s) unassigned');
                }

                if (result.academyCascade) {
                    var Cascade = getAcademyCascade();
                    if (Cascade && typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(result.academyCascade);
                        if (summary) {
                            parts.push(summary.replace(/^\(|\)$/g, ''));
                        }
                    }
                }

                var suffix = parts.length > 0
                    ? ' (' + parts.join(', ') + ')'
                    : '';

                return 'Deleted class: ' + result.className + suffix;
            },
            successMessage: 'Class deleted successfully!',
            failureMessage: 'Failed to delete class.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

    function getClass(classId) {
        var record = getClassInternal(classId);
        return record ? deepClone(record) : null;
    }

    function getClasses() {
        var records = getClassesInternal();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getClassesByStatus(status) {
        var records = getClassesByStatusInternal(status);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getClassByName(name) {
        var record = getClassByNameInternal(name);
        return record ? deepClone(record) : null;
    }

    function getDisplayName(classId) {
        return getClassDisplayNameInternal(classId);
    }

    function getCharacterClassNames(character) {
        return getCharacterClassNamesInternal(character);
    }

    function getCharacterClassesFor(character) {
        var records = getCharacterClassesInternal(character);
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    // ============================================================
    // REST DAYS RESOLUTION
    // ============================================================

    /**
     * Get the effective rest days for a class at a given week.
     *
     * Precedence:
     *   1. restDaysByWeek[week], when present
     *   2. restDays, otherwise
     *
     * Returns a fresh array. Empty array means either:
     *   - the class has no rest days for this week, OR
     *   - the week was invalid, OR
     *   - the stored rest days for this week are corrupt
     *
     * The three cases are indistinguishable at this API. Callers
     * that need to distinguish them should pre-validate the week
     * and inspect the stored fields directly.
     *
     * WHY [] FOR A MALFORMED WEEK:
     *   A malformed week is not a request for the default rest
     *   days. Returning the default on malformed input would
     *   convert bad input into plausible data. [] is the honest
     *   "no answer" signal for this API.
     */
    function getRestDaysForWeek(classId, week) {
        var cls = getClassInternal(classId);
        if (!cls) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        if (isObject(cls.restDaysByWeek)) {
            var key = String(weekNum);
            if (Object.prototype.hasOwnProperty.call(
                cls.restDaysByWeek, key
            )) {
                var overrideResult = normaliseRestDays(
                    cls.restDaysByWeek[key]
                );
                return overrideResult === null ? [] : overrideResult;
            }
        }

        var defaultResult = normaliseRestDays(cls.restDays);
        return defaultResult === null ? [] : defaultResult;
    }

    // ============================================================
    // CLASS IDS NORMALISATION (S10.1)
    // ============================================================

    function normaliseClassIds(char) {
        if (!char) return;
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
            return;
        }

        var seen = new Set();
        char.classIds = char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function getNormalisedClassIds(char) {
        if (!char) return [];
        if (!Array.isArray(char.classIds)) return [];

        var seen = new Set();
        return char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ============================================================
    // MEMBERSHIP MUTATIONS (S10.1)
    // ============================================================
    //
    // Every validator resolves references against the transaction
    // snapshot. Preflight reads against window.data are for early
    // UX feedback.

    function addToClass(charId, classId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!classId) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var CQ;
        try {
            CQ = requireCharacterQueries('addToClass');
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve(failure('Character is already in this class.'));
        }

        var name = CQ.getDisplayName(char);
        var targetChar = String(charId);
        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.characters)) {
                    return { valid: false, message: 'Character store is not available.' };
                }

                // Snapshot lookups.
                var currentChar = findCharacterInSnapshot(
                    appData, targetChar
                );
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!findClassInSnapshot(appData, targetClass)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                if (characterHasClassId(currentChar, targetClass)) {
                    return { valid: false, message: 'Character is already in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = findCharacterInSnapshot(data, targetChar);
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (characterHasClassId(currentChar, targetClass)) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(targetClass);

                return {
                    characterId: targetChar,
                    classId: targetClass,
                    className: cls.name
                };
            },

            logMessage: function() {
                return 'Added ' + name + ' to class: ' + cls.name;
            },

            successMessage: function() {
                return 'Character added to class successfully!';
            },
            failureMessage: 'Failed to add character to class.'
        });
    }

    function removeClassById(charId, classId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!classId) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var CQ;
        try {
            CQ = requireCharacterQueries('removeClassById');
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return Promise.resolve(failure('Class not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (!classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return Promise.resolve(failure('Character is not in this class.'));
        }

        var name = CQ.getDisplayName(char);
        var targetChar = String(charId);
        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.characters)) {
                    return { valid: false, message: 'Character store is not available.' };
                }

                var currentChar = findCharacterInSnapshot(
                    appData, targetChar
                );
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!findClassInSnapshot(appData, targetClass)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                if (!characterHasClassId(currentChar, targetClass)) {
                    return { valid: false, message: 'Character is not in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = findCharacterInSnapshot(data, targetChar);
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                var found = false;
                currentChar.classIds = currentChar.classIds.filter(function(cid) {
                    if (String(cid) === targetClass) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Character is not in this class.');
                }

                return {
                    characterId: targetChar,
                    classId: targetClass,
                    className: cls.name
                };
            },

            logMessage: function() {
                return 'Removed ' + name + ' from class: ' + cls.name;
            },

            successMessage: function() {
                return 'Character removed from class successfully!';
            },
            failureMessage: 'Failed to remove character from class.'
        });
    }

    function addClassByName(charId, className) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        if (!className || typeof className !== 'string' || className.trim() === '') {
            return Promise.resolve(failure('Class name is required.'));
        }

        var trimmedName = className.trim();

        var CQ;
        try {
            CQ = requireCharacterQueries('addClassByName');
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var existingClass = getClassByNameInternal(trimmedName);
        var name = CQ.getDisplayName(char);

        if (existingClass) {
            var classIds = getNormalisedClassIds(char);
            if (classIds.some(function(cid) { return String(cid) === String(existingClass.id); })) {
                return Promise.resolve(failure('Character is already in this class.'));
            }
        }

        var targetChar = String(charId);
        var normalisedTarget = normaliseClassName(trimmedName);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.characters)) {
                    return { valid: false, message: 'Character store is not available.' };
                }

                var currentChar = findCharacterInSnapshot(
                    appData, targetChar
                );
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                var currentClass = findClassByNameInSnapshot(
                    appData, normalisedTarget
                );
                if (currentClass) {
                    if (characterHasClassId(currentChar, currentClass.id)) {
                        return { valid: false, message: 'Character is already in this class.' };
                    }
                }

                return { valid: true };
            },

            mutate: function(data) {
                var classId = null;
                var className_ = trimmedName;
                var classCreated = false;

                if (!data.academy || typeof data.academy !== 'object') {
                    data.academy = {};
                }
                if (!data.academy.graduatingClasses ||
                    typeof data.academy.graduatingClasses !== 'object' ||
                    Array.isArray(data.academy.graduatingClasses)) {
                    data.academy.graduatingClasses = {};
                }

                // Class lookup by canonical name against the snapshot.
                var existing = null;
                var store = data.academy.graduatingClasses;
                var ids = Object.keys(store);
                for (var i = 0; i < ids.length; i++) {
                    var c = store[ids[i]];
                    if (c && normaliseClassName(c.name) === normalisedTarget) {
                        existing = c;
                        classId = ids[i];
                        break;
                    }
                }

                if (!existing) {
                    var now = new Date().toISOString();
                    classId = IdUtils.generateId('class');
                    var newClass = {
                        id: classId,
                        name: trimmedName,
                        status: 'active',
                        year: null,
                        description: '',
                        restDays: [],
                        restDaysByWeek: {},
                        createdAt: now,
                        updatedAt: now
                    };
                    data.academy.graduatingClasses[classId] = newClass;
                    existing = newClass;
                    classCreated = true;
                    className_ = newClass.name;
                } else {
                    className_ = existing.name;
                }

                var currentChar = findCharacterInSnapshot(data, targetChar);
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (characterHasClassId(currentChar, classId)) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(classId);

                return {
                    characterId: targetChar,
                    classId: classId,
                    className: className_,
                    classCreated: classCreated
                };
            },

            logMessage: function(result) {
                var action = result.classCreated ? 'created and added to' : 'added to';
                return action + ' class "' + result.className + '" for ' + name;
            },

            successMessage: function(result) {
                var action = result.classCreated ? 'created and added to' : 'added to';
                return 'Character ' + action + ' class "' + result.className + '"!';
            },
            failureMessage: 'Failed to add character to class.'
        });
    }

    function removeFromAllClasses(charId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var CQ;
        try {
            CQ = requireCharacterQueries('removeFromAllClasses');
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var classIds = getNormalisedClassIds(char);
        if (classIds.length === 0) {
            return Promise.resolve(success({
                count: 0,
                message: 'Character is not in any classes.'
            }));
        }

        var name = CQ.getDisplayName(char);
        var targetChar = String(charId);

        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.characters)) {
                    return { valid: false, message: 'Character store is not available.' };
                }
                var currentChar = findCharacterInSnapshot(data, targetChar);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = findCharacterInSnapshot(data, targetChar);
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                var count = getNormalisedClassIds(currentChar).length;
                currentChar.classIds = [];

                return { removedCount: count };
            },

            logMessage: function(result) {
                return 'Removed ' + result.removedCount + ' classes from ' + name;
            },

            successMessage: function(result) {
                return 'Removed ' + result.removedCount + ' classes from ' + name + '.';
            },
            failureMessage: 'Failed to remove classes.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClasses = {
        // ---- Class Entity CRUD ----
        create: create,
        update: update,
        delete: deleteClass,

        // ---- Membership mutations (S10.1) ----
        addToClass: addToClass,
        removeClassById: removeClassById,
        addClassByName: addClassByName,
        removeFromAllClasses: removeFromAllClasses,

        // ---- Public lookups (CLONES) ----
        getClass: getClass,
        getClasses: getClasses,
        getClassesByStatus: getClassesByStatus,
        getClassByName: getClassByName,
        getDisplayName: getDisplayName,
        getCharacterClassNames: getCharacterClassNames,
        getCharacterClasses: getCharacterClassesFor,

        // ---- Instructor-of-class derivation ----
        getClassInstructorIds: getClassInstructorIds,
        getClassInstructorIdsAllTime: getClassInstructorIdsAllTime,

        // ---- Internal (LIVE REFERENCES) ----
        getClassInternal: getClassInternal,
        getClassesInternal: getClassesInternal,
        getClassesByStatusInternal: getClassesByStatusInternal,
        getClassByNameInternal: getClassByNameInternal,
        getClassDisplayNameInternal: getClassDisplayNameInternal,
        getCharacterClassNamesInternal: getCharacterClassNamesInternal,
        getCharacterClassesInternal: getCharacterClassesInternal,

        // ---- Class IDs normalisation (S10.1) ----
        normaliseClassIds: normaliseClassIds,
        getNormalisedClassIds: getNormalisedClassIds,

        // ---- Rest days helpers (v30, extended v31) ----
        normaliseRestDays: normaliseRestDays,
        validateRestDays: validateRestDaysValue,
        normaliseRestDaysByWeek: normaliseRestDaysByWeek,
        validateRestDaysByWeek: validateRestDaysByWeekValue,
        getRestDaysForWeek: getRestDaysForWeek,

        // ---- Name comparison authority ----
        normaliseClassName: normaliseClassName,

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY
    };

})();
