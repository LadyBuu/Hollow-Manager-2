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
 *   back to restDays otherwise. Consumers that need rest days
 *   for a specific week call this function; they do not read
 *   class.restDays directly.
 *
 *   The calendar aggregator's readClassRestDays wraps
 *   getRestDaysForWeek. The teaching projector consults it to
 *   suppress occurrences whose day falls on a rest day for the
 *   target week. Nothing in this module consults rest days for
 *   any decision.
 *
 *   WHY A SPARSE MAP, NOT A RULE LIST:
 *     A rule list ("odd weeks: Sat/Sun", "week 7: none")
 *     expresses the same information more compactly, but
 *     requires every consumer to resolve a rule chain for every
 *     query. The sparse map turns the read path into a single
 *     hash lookup. The rule-list ergonomics live in the class
 *     form; on save, the form expands rules into per-week
 *     buckets. The map is the storage shape; the rules are the
 *     authoring shape.
 *
 * S10.1 MIGRATION:
 *   The four membership mutations (addToClass, removeClassById,
 *   addClassByName, removeFromAllClasses) and the two classIds-
 *   normalisation helpers (normaliseClassIds,
 *   getNormalisedClassIds) were moved here from
 *   character-classes.js. That file has been deleted.
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
 *        social scores, weekly teams. Delegated to
 *        AcademyCascade.classDeleted.
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
 * DEPENDENCIES (LAZY):
 *   - window.AcademyCascade
 *   - window.CharacterQueries
 *   - window.AcademyClassDisciplinesQueries
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

    function getAcademyCascade() {
        return window.AcademyCascade || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getAcademyClassDisciplinesQueries() {
        return window.AcademyClassDisciplinesQueries || null;
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
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var classes = getClassesInternal();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && cls.name && String(cls.name).toLowerCase().trim() === target) {
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
    //     Week-scoped. Reads offerings via
    //     AcademyClassDisciplinesQueries to filter out enrolments
    //     whose discipline is not currently offered. Filters
    //     enrolment intervals to those whose range contains the
    //     week. Filters to instructor mode.
    //
    //   getClassInstructorIdsAllTime(classId)
    //     "Who has EVER taught something in this class?"
    //     NOT week-scoped. Does NOT consult offerings; reads the
    //     enrolment bucket directly.
    //
    //   The two are deliberately separate. A character who taught
    //   Combat for Class 2026 during weeks 1-8 and stopped is an
    //   instructor for Class 2026 (all-time) but not for week 12
    //   (week-scoped). Both answers are correct for their
    //   respective questions.
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

        var offeringSet = Object.create(null);
        var offeringFilterAvailable = false;

        var Queries = getAcademyClassDisciplinesQueries();
        if (Queries &&
            typeof Queries.getClassDisciplinesForClass === 'function' &&
            typeof Queries.isActiveInWeek === 'function') {
            var offerings = [];
            try {
                offerings = Queries.getClassDisciplinesForClass(classId) || [];
            } catch (e) {
                offerings = [];
            }
            for (var oi = 0; oi < offerings.length; oi++) {
                var rec = offerings[oi];
                if (!rec || !rec.disciplineId) { continue; }
                var active = false;
                try {
                    active = Queries.isActiveInWeek(
                        classId, rec.disciplineId, weekNum
                    ) === true;
                } catch (e) {
                    active = false;
                }
                if (active) {
                    offeringSet[String(rec.disciplineId)] = true;
                }
            }
            offeringFilterAvailable = true;
        }

        var disciplineFilter = null;
        if (options && isNonEmptyString(options.disciplineId)) {
            disciplineFilter = String(options.disciplineId);
        }

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return [];
        }

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

                if (offeringFilterAvailable &&
                    offeringSet[discId] !== true) {
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

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return [];
        }

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
    // The accepted shape is an array of unique integers in
    // [MIN_DAY, MAX_DAY]. Duplicates are collapsed. Order is not
    // significant (the canonical form is sorted ascending by
    // normaliseRestDays below), but callers may pass any order.
    //
    // Rejections:
    //   - not an array
    //   - any element that cannot be parsed to an integer in range
    //
    // Silent no-op:
    //   - a caller who passes `undefined` gets the current value
    //     preserved. The validator does not treat `undefined` as
    //     "clear the field"; that requires an explicit `[]`.

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

    function normaliseRestDays(value) {
        var check = validateRestDaysValue(value);
        if (!check.valid) {
            return [];
        }
        if (check.value === undefined) {
            return [];
        }
        return check.value;
    }

    // ============================================================
    // REST DAYS BY WEEK VALIDATION
    // ============================================================
    //
    // The accepted shape is a plain object whose keys are week
    // numbers (or digit strings that parse to weeks in
    // [MIN_WEEK, MAX_WEEK]) and whose values are rest-day arrays.
    //
    // Duplicates across weeks are not a problem — each week's array
    // is independent. Duplicates within a week are collapsed by
    // validateRestDaysValue.
    //
    // Rejections:
    //   - not a plain object
    //   - any key that does not parse to a valid week
    //   - any value that fails validateRestDaysValue
    //
    // Silent no-op:
    //   - a caller who passes `undefined` gets the current value
    //     preserved. `{}` explicitly clears.

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

            // Store under canonical string week key.
            result[String(weekNum)] = dayCheck.value;
        }

        return { valid: true, value: result };
    }

    function normaliseRestDaysByWeek(value) {
        var check = validateRestDaysByWeekValue(value);
        if (!check.valid) {
            return {};
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

    /**
     * Create a new class.
     *
     * v30: restDays.
     * v31: restDaysByWeek.
     */
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: true };
                }
                var target = trimmedName.toLowerCase();
                var store = appData.academy.graduatingClasses;
                for (var id in store) {
                    if (Object.prototype.hasOwnProperty.call(store, id)) {
                        var cls = store[id];
                        if (cls && cls.name && String(cls.name).toLowerCase().trim() === target) {
                            return { valid: false, message: 'A class with this name already exists.' };
                        }
                    }
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

    /**
     * Update an existing class.
     *
     * v30: restDays.
     * v31: restDaysByWeek.
     */
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

        // ---- Legacy guards ----
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
            if (newName !== existing.name) {
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!appData.academy.graduatingClasses[target]) {
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
                if (!appData || !appData.academy || !appData.academy.graduatingClasses) {
                    return { valid: false, message: 'Class no longer exists.' };
                }
                if (!appData.academy.graduatingClasses[target]) {
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

                delete data.academy.graduatingClasses[target];

                var cascade = null;
                var Cascade = getAcademyCascade();
                if (Cascade && typeof Cascade.classDeleted === 'function') {
                    cascade = Cascade.classDeleted(data, target);
                }

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
    //
    // The canonical reader: given a class and a week, return the
    // effective rest days for that week.
    //
    // Precedence:
    //   1. restDaysByWeek[week], when present.
    //   2. restDays, otherwise.
    //
    // Returns a fresh array. The caller cannot mutate the underlying
    // storage through the returned reference. A malformed entry is
    // normalised defensively (empty array on any failure).

    function getRestDaysForWeek(classId, week) {
        var cls = getClassInternal(classId);
        if (!cls) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            // Fall back to the default when the week is malformed.
            // Callers that need a strict answer can pre-validate
            // the week themselves.
            return normaliseRestDays(cls.restDays);
        }

        if (isObject(cls.restDaysByWeek)) {
            var key = String(weekNum);
            if (Object.prototype.hasOwnProperty.call(
                cls.restDaysByWeek, key
            )) {
                return normaliseRestDays(cls.restDaysByWeek[key]);
            }
        }

        return normaliseRestDays(cls.restDays);
    }

    // ============================================================
    // CLASS IDS NORMALISATION (moved here in S10.1)
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
    // MEMBERSHIP MUTATIONS (moved here in S10.1)
    // ============================================================

    function addToClass(charId, classId) {
        if (!charId) {
            return Promise.resolve(failure('Character ID is required.'));
        }
        if (!classId) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
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

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!getClassInternal(classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return { valid: false, message: 'Character is already in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (currentChar.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(classId);

                return {
                    characterId: charId,
                    classId: classId,
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

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
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

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                if (!getClassInternal(classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                var currentClassIds = getNormalisedClassIds(currentChar);
                if (!currentClassIds.some(function(cid) { return String(cid) === String(classId); })) {
                    return { valid: false, message: 'Character is not in this class.' };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                var found = false;
                currentChar.classIds = currentChar.classIds.filter(function(cid) {
                    if (String(cid) === String(classId)) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Character is not in this class.');
                }

                return {
                    characterId: charId,
                    classId: classId,
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

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        var existingClass = getClassByNameInternal(trimmedName);
        var name = CharacterQueries.getDisplayName(char);

        if (existingClass) {
            var classIds = getNormalisedClassIds(char);
            if (classIds.some(function(cid) { return String(cid) === String(existingClass.id); })) {
                return Promise.resolve(failure('Character is already in this class.'));
            }
        }

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                var currentClass = getClassByNameInternal(trimmedName);
                if (currentClass) {
                    var currentClassIds = getNormalisedClassIds(currentChar);
                    if (currentClassIds.some(function(cid) { return String(cid) === String(currentClass.id); })) {
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

                var nameLower = trimmedName.toLowerCase();
                var existing = null;
                Object.keys(data.academy.graduatingClasses).forEach(function(id) {
                    var c = data.academy.graduatingClasses[id];
                    if (c && c.name && String(c.name).toLowerCase() === nameLower) {
                        existing = c;
                        classId = id;
                    }
                });

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

                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                normaliseClassIds(currentChar);

                if (currentChar.classIds.some(function(cid) { return String(cid) === String(classId); })) {
                    throw new Error('Character is already in this class.');
                }

                currentChar.classIds.push(classId);

                return {
                    characterId: charId,
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

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return Promise.resolve(failure('CharacterQueries is not available.'));
        }

        var char = CharacterQueries.getCharacterById(charId);
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

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

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

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY
    };

})();
